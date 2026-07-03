<?
	include ("../db_connect.php");
	
	$id = $_GET['id'];	
	
	OpenConnection();
	
	$sql = "DELETE FROM help_capitoli WHERE id = ".$id;
	
	$query = mysql_query($sql);	
	
	CloseConnection();		
	
	header("Location: gest_help.php");
?>