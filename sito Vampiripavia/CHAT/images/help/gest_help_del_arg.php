<?
	include ("../db_connect.php");
	
	$id = $_GET['id'];	
	
	OpenConnection();
	
	$sql = "DELETE FROM help_argomenti WHERE id = ".$id;
	
	$query = mysql_query($sql);

	CloseConnection();		
	
	header("Location: gest_help.php");
?>